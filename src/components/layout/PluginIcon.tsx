"use client";

import { lazy, Suspense, useMemo } from "react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { Puzzle } from "lucide-react";
import type { LucideProps } from "lucide-react";

interface PluginIconProps extends LucideProps {
  name: string;
}

export function PluginIcon({ name, ...props }: PluginIconProps) {
  const IconComponent = useMemo(() => {
    const key = name as keyof typeof dynamicIconImports;
    if (key in dynamicIconImports) {
      return lazy(dynamicIconImports[key]);
    }
    return null;
  }, [name]);

  if (!IconComponent) {
    return <Puzzle {...props} />;
  }

  return (
    <Suspense fallback={<Puzzle {...props} />}>
      <IconComponent {...props} />
    </Suspense>
  );
}
