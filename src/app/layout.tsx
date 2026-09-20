import './globals.css';
import React from 'react';
import type { Viewport, Metadata } from 'next';
import { Inter, Playfair_Display, Roboto_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-sans',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-display',
  display: 'swap',
});

const robotoMono = Roboto_Mono({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Personal Finance Cockpit',
  description: 'Trung tâm chỉ huy tài chính cá nhân dành cho duy nhất một người dùng',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="vi"
      className={`${inter.variable} ${playfair.variable} ${robotoMono.variable} dark`}
    >
      <body className="min-h-screen bg-[#0f1011] text-[#9f9fa0] font-sans antialiased selection:bg-[#2e2e2e] selection:text-[#ffffff]">
        {children}
      </body>
    </html>
  );
}
