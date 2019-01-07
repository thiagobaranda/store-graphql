import { difference, filter, map, nth, path } from 'ramda'
import ResolverError from '../../errors/resolverError'
import { mapKeyValues } from '../../utils/object'
import { validateItems, validateListItem } from './util'
import { acronymList, acronymListProduct, fields, fieldsListProduct } from './util'

const getListItemsWithProductInfo = (items, catalog) => Promise.all(
    map(async item => {
      const productsResponse = await catalog.productBySku([path(['skuId'], item)])
      const product = nth(0, productsResponse)
      return { ...item, product }
    }, items)
  )

const getListItems = async (itemsId, dataSources) => {
  const { catalog, document } = dataSources
  const items = itemsId ? await Promise.all(map(itemId => 
    document.getDocument(acronymListProduct, itemId, fieldsListProduct), itemsId)) : []
  return getListItemsWithProductInfo(items, catalog)
}

const addListItem = async (item, document) => {
  const { DocumentId } = await document.createDocument(acronymListProduct, mapKeyValues({ ...item }))
  return DocumentId
}

const addItems = async (items = [], dataSources) => {
  const { document } = dataSources
  validateItems(items, dataSources)
  const promises = map(async item => addListItem(item, document), items)
  return Promise.all(promises)
}

const deleteItems = (items, document) => (
  items && items.forEach(item => document.deleteDocument(acronymListProduct, path(['itemId'], item)))
)

const updateItems = async (items, dataSources) => {
  const { document } = dataSources
  const itemsToBeDeleted = filter(item => path(['itemId'], item) && path(['quantity'], item) === 0, items)
  const otherItems = difference(items, itemsToBeDeleted)
  const itemsUpdated = await map(async item => {
    const itemId = path(['itemId'], item)
    validateListItem(items, item, dataSources)
    if (itemId) {
      await document.updateDocument(acronymListProduct, itemId, mapKeyValues(item))
      return itemId
    }
    return await addListItem(item, document)
  }, otherItems)
  deleteItems(itemsToBeDeleted, document)
  return itemsUpdated
}

export const queries = {
  list: async (_, { id }, { dataSources, dataSources: { document } }) => {
    const list = await document.getDocument(acronymList, id, fields)
    const items = await getListItems(list.items, dataSources)
    return { id, ...list, items }
  },

  listsByOwner: async (_, { owner, page, pageSize }, context) => {
    const { dataSources, dataSources: { document } } = context
    const lists = await document.searchDocuments(acronymList, fields, `owner=${owner}`, { page, pageSize})
    const listsWithProducts = map(async list => {
      const items = await getListItems(path(['items'], list), dataSources)
      return { ...list, items }
    }, lists)
    return Promise.all(listsWithProducts)
  }
}

export const mutation = {
  createList: async (_, { list, list: { items } }, context) => {
    const { dataSources, dataSources: { document } } = context
    try {
      const itemsId = await addItems(items, dataSources)
      const { DocumentId } = await document.createDocument(acronymList, mapKeyValues({ ...list, items: itemsId }))
      return queries.list(_, { id: DocumentId }, context)
    } catch (error) {
      throw new ResolverError(`Cannot create list: ${error}`, 406)
    }
  },

  deleteList: async (_, { id }, { dataSources: { document } }) => {
    const { items } = await document.getDocument(acronymList, id, fields)
    deleteItems(items, document)
    return document.deleteDocument(acronymList, id)
  },

  /**
   * Update the list informations and its items.
   * If the item given does not have the itemId, add it as a new item in the list
   * If the item given has got an itemId, but its quantity is 0, remove it from the list
   * Otherwise, update it.
   */
  updateList: async (_, { id, list, list: { items } }, context) => {
    const { dataSources, dataSources: { document } } = context
    try {
      const itemsUpdatedId = await updateItems(items, dataSources)
      await document.updateDocument(acronymList, id, mapKeyValues({ ...list, items: itemsUpdatedId }))
      return queries.list(_, { id }, context)
    } catch (error) {
      throw new ResolverError(`Cannot update the list: ${error}`, 406)
    }
  },
}