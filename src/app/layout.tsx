import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Header from '@/components/layout/Header';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Palamedes — UK Immigration Casework',
  description:
    'AI-assisted intake, summarisation, and document generation for UK immigration solicitors.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="corporate">
      <body className={inter.className}>
        <Header />
        <main className="min-h-screen bg-base-200">{children}</main>
      </body>
    </html>
  );
}
