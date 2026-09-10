"use client";

import { Flex, Spin } from "antd";

/**
 * The whole viewport, while the session resolves. It occupies the full height
 * on purpose: swapping a small inline spinner for the landing panel makes the
 * page jump, and the landing panel must never flash for someone who is in fact
 * signed in.
 */
export function FullPageSpin() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
      <Spin size="large" aria-label="Loading" />
    </Flex>
  );
}
