"use client";

import { Alert, Button } from "antd";

interface ErrorStateProps {
  title: string;
  description?: string;
  onRetry?: () => void;
}

/** A failure the person can see and, where there is something to try, retry. */
export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <Alert
      type="error"
      showIcon
      message={title}
      description={description}
      action={
        onRetry ? (
          <Button size="small" danger onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  );
}
