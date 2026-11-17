// The global props the shell sends (LynxViewController.globalProps() in
// packages/native's iOS template) that this app reads: its safe-area insets.
// Augmented on both of the interfaces: ReactLynx's useGlobalProps() returns
// its own, and lynx.__globalProps is @lynx-js/types'.
interface ShellGlobalProps {
  safeAreaTop?: number;
  safeAreaBottom?: number;
}

declare module '@lynx-js/types' {
  interface GlobalProps extends ShellGlobalProps {}
}

declare module '@lynx-js/react' {
  interface GlobalProps extends ShellGlobalProps {}
}

export {};
