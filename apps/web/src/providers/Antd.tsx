"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import type { ReactNode } from "react";

/**
 * Ant Design's CSS-in-JS emits styles at render time. Next still prerenders
 * client components at build time, so without a registry to collect that CSS
 * into the document head the first paint arrives unstyled (PLAN.md §4). The
 * registry is cheaper than disabling prerendering.
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{ token: { fontFamily: "var(--font-geist-sans), sans-serif" } }}
      >
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}
