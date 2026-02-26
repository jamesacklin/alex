import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "UI/Badge",
  component: Badge,
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "destructive", "outline", "ghost", "link"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { children: "PDF" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "EPUB" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Overdue" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "Draft" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Hidden" },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="link">Link</Badge>
    </div>
  ),
};

export const FileTypes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge variant="secondary">PDF</Badge>
      <Badge variant="secondary">EPUB</Badge>
    </div>
  ),
};

export const UserRoles: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge variant="default">admin</Badge>
      <Badge variant="secondary">user</Badge>
    </div>
  ),
};
