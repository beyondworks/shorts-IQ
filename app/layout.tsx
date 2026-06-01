import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shorts Intelligence',
  description: 'YouTube Shorts trend template intelligence dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
