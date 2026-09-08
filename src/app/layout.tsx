import './globals.css';
import React from 'react';
import type { Viewport } from 'next';

export const metadata = {
  title: 'FinTrack Pro - Quản lý chi tiêu',
  description: 'Hệ thống quản lý tài chính cá nhân toàn diện, thông minh và hiện đại',
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
    <html lang="vi">
      <body className="min-h-screen bg-app text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
