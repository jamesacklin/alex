import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { PdfToolbar } from "./PdfToolbar";

const meta: Meta<typeof PdfToolbar> = {
  title: "Readers/PdfToolbar",
  component: PdfToolbar,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
    },
  },
};

export default meta;
type Story = StoryObj<typeof PdfToolbar>;

function PdfToolbarWrapper(props: Omit<React.ComponentProps<typeof PdfToolbar>, "pageInputRef">) {
  const ref = useRef<HTMLInputElement>(null);
  return <PdfToolbar {...props} pageInputRef={ref} />;
}

export const Default: Story = {
  render: () => (
    <PdfToolbarWrapper
      title="Structure and Interpretation of Computer Programs"
      currentPage={42}
      numPages={657}
      zoomPercent={100}
      onPrevPage={() => {}}
      onNextPage={() => {}}
      onGoToPage={() => {}}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onFit={() => {}}
      onSearchToggle={() => {}}
    />
  ),
};

export const FirstPage: Story = {
  render: () => (
    <PdfToolbarWrapper
      title="Dune"
      currentPage={1}
      numPages={412}
      zoomPercent={100}
      onPrevPage={() => {}}
      onNextPage={() => {}}
      onGoToPage={() => {}}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onFit={() => {}}
      onSearchToggle={() => {}}
    />
  ),
};

export const LastPage: Story = {
  render: () => (
    <PdfToolbarWrapper
      title="Neuromancer"
      currentPage={271}
      numPages={271}
      zoomPercent={150}
      onPrevPage={() => {}}
      onNextPage={() => {}}
      onGoToPage={() => {}}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onFit={() => {}}
      onSearchToggle={() => {}}
    />
  ),
};

export const ZoomedOut: Story = {
  render: () => (
    <PdfToolbarWrapper
      title="Technical Manual"
      currentPage={5}
      numPages={89}
      zoomPercent={50}
      onPrevPage={() => {}}
      onNextPage={() => {}}
      onGoToPage={() => {}}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onFit={() => {}}
      onSearchToggle={() => {}}
    />
  ),
};

export const Loading: Story = {
  render: () => (
    <PdfToolbarWrapper
      title="Loading document..."
      currentPage={1}
      numPages={null}
      zoomPercent={100}
      onPrevPage={() => {}}
      onNextPage={() => {}}
      onGoToPage={() => {}}
      onZoomIn={() => {}}
      onZoomOut={() => {}}
      onFit={() => {}}
      onSearchToggle={() => {}}
    />
  ),
};
