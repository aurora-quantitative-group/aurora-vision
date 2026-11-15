import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Aurora Ithaca',
  description: 'Aurora Ithaca match totals and daily activity at HackUTA.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
