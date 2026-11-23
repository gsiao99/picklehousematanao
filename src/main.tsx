import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import '@fontsource-variable/outfit/wght.css'
import '@fontsource-variable/inter/wght.css'
import '@/styles/index.css'
import { router } from '@/app/router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { playOpening } from '@/features/entrance/entrance'
import { EntranceOverlay } from '@/features/entrance/EntranceOverlay'

// The logo entrance when the website is opened on the homepage (once per visit).
playOpening()

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
      <EntranceOverlay />
    </AuthProvider>
  </StrictMode>,
)
