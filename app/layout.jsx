import './globals.css'

export const metadata = {
  title: 'NCICS: Tropical Monitoring',
  description: 'NCICS Tropical Monitoring Interface',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
