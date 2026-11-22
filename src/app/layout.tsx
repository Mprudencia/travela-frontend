import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { GoogleAnalytics } from '@next/third-parties/google';
import Script from 'next/script';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? 'G-E0NQKTR0BM';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Travela — Stay Connected Across Africa',
  description:
    'Buy and activate local eSIM data plans instantly across Africa. No roaming fees, no plastic cards.',
  keywords: ['eSIM', 'Africa', 'travel', 'data', 'roaming', 'connectivity'],
  openGraph: {
    title: 'Travela — Stay Connected Across Africa',
    description: 'Instant eSIM bundles across Africa.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={plusJakarta.variable} data-scroll-behavior="smooth">
      <body>
        <Script id="bundles-scroll-top" strategy="beforeInteractive">
          {`try{var path=location.pathname;if(path==="/bundles"||path==="/checkout"){history.scrollRestoration="manual";var pin=function(){if(window.__travelaUserScrolled)return;var el=document.documentElement;var prev=el.style.scrollBehavior;el.style.scrollBehavior="auto";window.scrollTo(0,0);el.scrollTop=0;document.body.scrollTop=0;el.style.scrollBehavior=prev;};var mark=function(){window.__travelaUserScrolled=1;};pin();document.addEventListener("DOMContentLoaded",pin);window.addEventListener("load",pin);addEventListener("pointerdown",mark);addEventListener("wheel",mark,{passive:true});addEventListener("touchmove",mark,{passive:true});addEventListener("keydown",mark);}else{history.scrollRestoration="auto";}}catch(e){}`}
        </Script>
        <AuthProvider>
          <div className="flex flex-col min-h-screen">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </AuthProvider>
      </body>
      <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />
    </html>
  );
}
