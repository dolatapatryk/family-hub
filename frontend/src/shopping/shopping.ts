export interface ShoppingItem {
  id: string
  name: string
  quantity: string | null
  store: string | null
  completed: boolean
  addedBy: string
  createdAt: string
}
