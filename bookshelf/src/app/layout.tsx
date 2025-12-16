import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/providers/SessionProvider";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "Life on Books - Track Your Reading Journey",
  description: "A community for book lovers to track reading, write reviews, and discover new books.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${roboto.variable} font-sans antialiased bg-gray-50 text-gray-900`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
