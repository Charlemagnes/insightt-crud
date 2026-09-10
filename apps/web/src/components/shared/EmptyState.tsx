"use client";

import { Empty } from "antd";
import type { ReactNode } from "react";

interface EmptyStateProps {
  description: string;
  action?: ReactNode;
}

/** Zero Tasks — the first thing a new account sees, so it says what to do next. */
export function EmptyState({ description, action }: EmptyStateProps) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
      {action}
    </Empty>
  );
}
