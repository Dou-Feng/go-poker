import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html>
      <Head>
        {/* Start the first-paint downloads at HTML-parse time, in parallel
            with the JS bundle, instead of waiting for React to hydrate and
            the Preloader to begin fetching. Fonts must be preloaded with
            crossorigin (they are always fetched in CORS mode) or the browser
            downloads them twice. The wallpaper media queries mirror the CSS
            in styles/Register.module.css so exactly one variant loads. */}
        <link
          rel="preload"
          href="/fonts/nunito-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/nunito-latin-ext.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/FZLTTHJW-subset.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/bg/bg-portrait.webp"
          as="image"
          type="image/webp"
          media="(orientation: portrait)"
        />
        <link
          rel="preload"
          href="/bg/bg-1672.webp"
          as="image"
          type="image/webp"
          media="(min-width: 700px) and (orientation: landscape)"
        />
        <link
          rel="preload"
          href="/bg/bg-1100.webp"
          as="image"
          type="image/webp"
          media="(max-width: 699.98px) and (orientation: landscape)"
        />
      </Head>
      <body className="m-0 bg-card p-0">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
