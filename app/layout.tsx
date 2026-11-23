import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProcureDesk — thoughtful purchases, confident decisions",
  description: "A clear, reliable purchasing workspace. Request what your team needs, approve within budget, and follow every purchase through delivery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
