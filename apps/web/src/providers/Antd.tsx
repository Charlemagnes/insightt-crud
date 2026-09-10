"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import type { ReactNode } from "react";

/**
 * The single source of truth for typography: antd's theme token, fed the CSS
 * variable `next/font` publishes on `<html>`. Setting `font-family` in CSS as
 * well would give the app two fallback stacks that drift apart.
 */
const FONT_FAMILY =
  'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/**
 * Ant Design's CSS-in-JS emits styles at render time. Next still prerenders
 * client components at build time, so without a registry to collect that CSS
 * into the document head the first paint arrives unstyled (PLAN.md §4). The
 * registry is cheaper than disabling prerendering.
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      <ConfigProvider theme={{ token: { fontFamily: FONT_FAMILY } }}>
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}
