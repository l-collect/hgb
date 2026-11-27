import { Component, type ErrorInfo, type ReactNode } from "react";
import { paths } from "../router";
import { ButtonLink, ErrorCard } from "./ui";

/**
 * Catches a page that fails while drawing (a reply it did not expect, a bug), so the frame and its navigation stay and
 * only the page says 「这页出错了」 with 重试 and 回到任务. A new [resetKey] (another address) tries again by itself.
 */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("页面出错", error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <ErrorCard text="这页出错了" retry={() => this.setState({ failed: false })} extra={<ButtonLink small to={paths.tasks}>回到任务</ButtonLink>} />;
  }
}
