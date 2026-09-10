"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Flex, Layout, Space, Typography } from "antd";

import { LogoutButton } from "@/components/auth/LogoutButton";

const { Header } = Layout;
const { Text, Title } = Typography;

/** Who is signed in, and the way out. */
export function AppHeader() {
  const { user } = useAuth0();

  return (
    <Header style={{ background: "transparent", paddingInline: 24 }}>
      <Flex align="center" justify="space-between" style={{ height: "100%" }}>
        <Title level={4} style={{ margin: 0 }}>
          Task List
        </Title>
        <Space size="middle">
          {/* Auth0 falls back to the email when the connection carries no name. */}
          <Text strong>{user?.name ?? user?.email}</Text>
          <LogoutButton />
        </Space>
      </Flex>
    </Header>
  );
}
