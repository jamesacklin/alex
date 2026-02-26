import type { Meta, StoryObj } from "@storybook/react";
import { AppLogo } from "./AppLogo";

const meta: Meta<typeof AppLogo> = {
  title: "Branding/AppLogo",
  component: AppLogo,
};

export default meta;
type Story = StoryObj<typeof AppLogo>;

export const Default: Story = {};

export const Large: Story = {
  args: { className: "h-12 w-12" },
};

export const Small: Story = {
  args: { className: "h-4 w-4" },
};

export const WithTitle: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <AppLogo className="h-8 w-8" />
      <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
    </div>
  ),
};
