/** Browser entry point. */
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import './styles.css'

const container = document.getElementById('root')
if (container === null) throw new Error('preview root element is missing')
createRoot(container).render(<App />)
