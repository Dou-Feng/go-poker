import React, { ReactNode, Fragment } from "react";
import Head from "next/head";

type Props = {
  children?: ReactNode;
  title?: string;
  themeColor?: string;
};

const Layout = ({ children, title = "page", themeColor = "#0e1319" }: Props) => (
  <Fragment>
    <Head>
      <title>{title}</title>
      <meta charSet="utf-8" />
      <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      <meta name="theme-color" content={themeColor} key="theme-color" />
    </Head>
    <main>{children}</main>
  </Fragment>
);

export default Layout;
