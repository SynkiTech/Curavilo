import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Curavilo - Healthcare Operating Platform",
  description:
    "Configurable, multi-tenant, AI-powered healthcare operating platform for hospitals, clinics, diagnostic centres, laboratories and pharmacies.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%230f766e'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>C</text></svg>",
  },
};

/**
 * Some browser extensions (screenshot/measurement overlays) stamp every DOM
 * element with attributes like bis_size / bis_status / __processed_*__ between
 * the server HTML arriving and React hydrating. React then sees attributes it
 * never rendered and logs a hydration mismatch. suppressHydrationWarning only
 * covers one element, so instead we sweep the attributes off the document and
 * keep removing them via MutationObserver BEFORE the hydration bundle runs.
 * Attributes are added by the extension purely for its own UI, so removing
 * them is safe and unobservable to the user.
 */
const EXT_ATTR_CLEANUP = `(function(){
  if (typeof document === "undefined") return;
  var isBad = function(name) {
    return name.indexOf("bis_") === 0 || name.indexOf("__processed_") === 0;
  };
  var clean = function(el) {
    if (!el || el.nodeType !== 1 || !el.attributes) return;
    for (var i = el.attributes.length - 1; i >= 0; i--) {
      var attr = el.attributes[i];
      if (isBad(attr.name)) el.removeAttribute(attr.name);
    }
  };
  var sweep = function() {
    clean(document.documentElement);
    clean(document.body);
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) clean(all[i]);
  };
  sweep();
  try {
    var obs = new MutationObserver(function(muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "attributes") {
          clean(m.target);
        } else if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.nodeType === 1) {
              clean(node);
              if (node.querySelectorAll) {
                var inner = node.querySelectorAll("*");
                for (var k = 0; k < inner.length; k++) clean(inner[k]);
              }
            }
          }
        }
      }
    });
    obs.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  } catch (e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: EXT_ATTR_CLEANUP }} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
