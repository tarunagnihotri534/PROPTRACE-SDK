import React from "react";

interface InnerProps {
  label: string;
  extra: string;
}

export function Inner({ label, extra }: InnerProps) {
  return (
    <div>
      <p>{label}</p>
      <p>{extra}</p>
    </div>
  );
}
