"use client";

import { SHARED_PACKAGE_NAME } from "@insightt/shared";
import { Flex, Typography } from "antd";

const { Title, Paragraph, Text } = Typography;

/**
 * Placeholder shell. The landing panel, the auth gate and the task list arrive
 * in the tickets that follow; what this renders today is the prefactor made
 * visible — every pixel comes from Ant Design, and the wire-contract package
 * compiles through `transpilePackages`.
 */
export default function Home() {
  return (
    <Flex
      vertical
      align="center"
      justify="center"
      gap="small"
      style={{ minHeight: "100vh" }}
    >
      <Title level={1}>Task List</Title>
      <Paragraph type="secondary">Sign-in arrives in the next ticket.</Paragraph>
      <Text type="secondary" code>
        {SHARED_PACKAGE_NAME}
      </Text>
    </Flex>
  );
}
