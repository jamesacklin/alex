import type { Meta, StoryObj } from "@storybook/react";
import { SlidingUnderlineTabs } from "./SlidingUnderlineTabs";

const meta: Meta<typeof SlidingUnderlineTabs> = {
  title: "Navigation/SlidingUnderlineTabs",
  component: SlidingUnderlineTabs,
  parameters: {
    nextjs: {
      appDirectory: true,
    },
  },
};

export default meta;
type Story = StoryObj<typeof SlidingUnderlineTabs>;

export const SettingsTabs: Story = {
  args: {
    activeHref: "/admin/general",
    items: [
      { label: "General", href: "/admin/general" },
      { label: "Users", href: "/admin/users" },
      { label: "Library", href: "/admin/library" },
    ],
  },
};

export const UsersActive: Story = {
  args: {
    activeHref: "/admin/users",
    items: [
      { label: "General", href: "/admin/general" },
      { label: "Users", href: "/admin/users" },
      { label: "Library", href: "/admin/library" },
    ],
  },
};

export const TwoTabs: Story = {
  args: {
    activeHref: "/overview",
    items: [
      { label: "Overview", href: "/overview" },
      { label: "Details", href: "/details" },
    ],
  },
};
