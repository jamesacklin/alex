import type { Meta, StoryObj } from "@storybook/react";
import { PillNavigation } from "./PillNavigation";

const meta: Meta<typeof PillNavigation> = {
  title: "Navigation/PillNavigation",
  component: PillNavigation,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/library",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PillNavigation>;

export const Default: Story = {
  args: {
    items: [
      { label: "Library", href: "/library" },
      { label: "Collections", href: "/collections" },
      { label: "Settings", href: "/admin/general" },
    ],
  },
};

export const SettingsNav: Story = {
  args: {
    items: [
      { label: "General", href: "/admin/general" },
      { label: "Users", href: "/admin/users" },
      { label: "Library", href: "/admin/library" },
    ],
  },
  parameters: {
    nextjs: {
      navigation: {
        pathname: "/admin/general",
      },
    },
  },
};

export const CollectionsActive: Story = {
  args: {
    items: [
      { label: "Library", href: "/library" },
      { label: "Collections", href: "/collections" },
      { label: "Settings", href: "/admin/general" },
    ],
  },
  parameters: {
    nextjs: {
      navigation: {
        pathname: "/collections",
      },
    },
  },
};
