import toolNavItems from '../../../../assets/js/tool-nav-data.json';

type ToolNavProps = {
  currentTool: string;
};

type ToolNavItem = {
  id: string;
  label: string;
};

export default function ToolNav({ currentTool }: ToolNavProps) {
  return (
    <nav className="topbar-nav" aria-label="ツール移動" data-tool-nav data-current={currentTool}>
      {(toolNavItems as ToolNavItem[])
        .filter((item) => item.id !== currentTool)
        .map((item) => (
          <a className="topbar-link" href={`../${item.id}/`} key={item.id}>
            {item.label}
          </a>
        ))}
    </nav>
  );
}
