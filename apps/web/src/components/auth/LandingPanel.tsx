"use client";

import { Card, Flex, Typography } from "antd";

import { LoginButton } from "@/components/auth/LoginButton";

const { Title, Paragraph } = Typography;

/** What a signed-out person sees: an explanation and one button. */
export function LandingPanel() {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: "100vh", padding: 24 }}
    >
      <Card style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <Title level={2} style={{ marginTop: 0 }}>
          Task List
        </Title>
        <Paragraph type="secondary">
          Sign in to see your tasks. Nobody else can see them.
        </Paragraph>
        <LoginButton />
      </Card>
    </Flex>
  );
}
