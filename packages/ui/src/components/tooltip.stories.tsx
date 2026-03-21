import type { Meta, StoryObj } from "@storybook/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { Button } from "./button";

const meta: Meta<typeof Tooltip> = {
  title: "UI/Tooltip",
  component: Tooltip,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm">
          Hover me
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Add to your library</p>
      </TooltipContent>
    </Tooltip>
  ),
};

export const DisabledAction: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button variant="destructive" size="sm" disabled>
            Delete
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Cannot delete your own account</TooltipContent>
    </Tooltip>
  ),
};
