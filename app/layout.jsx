import './globals.css'

export const metadata = {
  title: 'Precipitation Visualization',
  description: 'Precipitation Visualization',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
