import { useRoutes } from 'react-router-dom'
import routes from 'virtual:generated-pages-react'

export function App() {
  return useRoutes(routes)
}
