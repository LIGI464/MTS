import { createContext, useContext, type ComponentPropsWithoutRef } from "react";

export const ProjectNavigation = createContext<((path: string) => void) | null>(null);

export function ProjectLink({ href, ...props }: Omit<ComponentPropsWithoutRef<"a">, "onClick"> & { href: string }) {
  const navigate = useContext(ProjectNavigation);

  return (
    <a {...props} href={href} onClick={(event) => {
      if (!navigate || props.target || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      navigate(href);
    }} />
  );
}
