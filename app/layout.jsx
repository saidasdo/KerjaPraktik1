import './globals.css'

export const metadata = {
  title: 'Tes 1',
  description: 'Tes 1',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
