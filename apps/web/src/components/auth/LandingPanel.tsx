"use client";

import { Card, Flex, Space, Typography } from "antd";

import { LoginButton } from "@/components/auth/LoginButton";
import { SignUpButton } from "@/components/auth/SignUpButton";

const { Title, Paragraph } = Typography;

/**
 * What a signed-out person sees: an explanation and the two ways in.
 *
 * Both buttons leave for the same Auth0 redirect and differ only in which
 * screen it opens, but they are offered separately because someone with no
 * account cannot tell from a "Log in" button that one can be made — the signup
 * tab is a link on a page they have to reach first.
 */
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
          Sign in to see your tasks, or sign up to start a list of your own.
          Nobody else can see them.
        </Paragraph>
        <Space size="middle" wrap>
          <LoginButton />
          <SignUpButton />
        </Space>
      </Card>
    </Flex>
  );
}
