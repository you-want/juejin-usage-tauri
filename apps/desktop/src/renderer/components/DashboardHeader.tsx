import type { Key } from "@heroui/react";
import { Moon, Sun } from "@gravity-ui/icons";
import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useTheme } from "@/hooks/useTheme";

/** Dashboard top bar with theme controls. */
export function DashboardHeader() {
  const { theme, setTheme } = useTheme();

  const changeTheme = (keys: Set<Key>) => {
    const nextTheme = [...keys][0];
    if (nextTheme === "light" || nextTheme === "dark") {
      setTheme(nextTheme);
    }
  };

  return (
    <header className="mbe-[30px] flex min-h-16 flex-wrap items-center justify-between gap-3 px-1 sm:px-0">
      <h1 className="text-3xl font-bold">AI Usage</h1>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <ToggleButtonGroup
          aria-label="页面主题"
          className="rounded-full bg-default p-1"
          disallowEmptySelection
          isDetached
          selectedKeys={new Set<Key>([theme])}
          selectionMode="single"
          size="sm"
          onSelectionChange={changeTheme}
        >
          <ToggleButton
            aria-label="使用亮色模式"
            className="data-[selected=true]:bg-surface data-[selected=true]:text-foreground data-[selected=true]:shadow-sm"
            id="light"
            isIconOnly
            variant="ghost"
          >
            <Sun />
          </ToggleButton>
          <ToggleButton
            aria-label="使用暗色模式"
            className="data-[selected=true]:bg-surface data-[selected=true]:text-foreground data-[selected=true]:shadow-sm"
            id="dark"
            isIconOnly
            variant="ghost"
          >
            <Moon />
          </ToggleButton>
        </ToggleButtonGroup>
      </div>
    </header>
  );
}
