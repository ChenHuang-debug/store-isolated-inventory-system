import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "多店库存管理系统",
    template: "%s｜多店库存管理系统",
  },
  description: "面向多店铺运营团队的安全库存工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <footer className="site-footer">
          <span>Portfolio demonstration · synthetic data only</span>
        </footer>
      </body>
    </html>
  );
}
