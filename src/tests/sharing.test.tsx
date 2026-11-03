import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareButton, SharingBanner, SharingProvider } from "../features/sharing/SharingProvider";
import type { ReportFilter, SharingStatus } from "../lib/types";
import { api } from "../lib/ipc";

vi.mock("../app/AppProvider", () => ({useAppData:() => ({projects:[{id:"alpha",name:"Approved project"}],clients:[],tags:[]})}));
vi.mock("../components/Toast", () => ({useToast:() => ({pushToast:vi.fn()})}));
vi.mock("../lib/ipc", () => ({
  normalizeError:(error:Error) => ({message:error.message}),
  api:{getSharingStatus:vi.fn(),previewSharing:vi.fn(),startSharing:vi.fn(),stopSharing:vi.fn(),rotateSharingLink:vi.fn()},
}));

const filter:ReportFilter = {dateFrom:"2026-11-01",dateTo:"2026-11-04",timezone:"Asia/Manila",projectId:"alpha"};
const off:SharingStatus = {phase:"stopped",message:"Sharing is off",url:null,expiresAtUtc:null,scope:null};
const projection = {title:"Approved report",dateFrom:filter.dateFrom,dateTo:filter.dateTo,timezone:filter.timezone,totalSeconds:3600,entryCount:1,
  entries:[{project:"Approved project",seconds:3600,running:false}]};

function TestApp({currentFilter = filter}:{currentFilter?:ReportFilter}) {
  return <SharingProvider><SharingBanner /><ShareButton filter={currentFilter} title="Approved report" /></SharingProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSharingStatus).mockResolvedValue(off);
  vi.mocked(api.previewSharing).mockResolvedValue(projection);
  vi.mocked(api.stopSharing).mockResolvedValue(off);
});

describe("live sharing ownership", () => {
  it("previews a frozen scope with private fields hidden and starts only on an explicit create", async () => {
    vi.mocked(api.startSharing).mockResolvedValue({...off,phase:"starting",message:"Connecting"});
    const app = render(<TestApp />);
    fireEvent.click(screen.getByRole("button",{name:"Share"}));
    await waitFor(() => expect(screen.getByRole("button",{name:"Create public link"})).toBeEnabled());
    expect(api.startSharing).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox",{name:"Include work descriptions"})).not.toBeChecked();
    expect(screen.getByRole("checkbox",{name:"Include billable status and totals"})).not.toBeChecked();
    app.rerender(<TestApp currentFilter={{...filter,projectId:"other",dateFrom:"2000-01-01"}} />);
    fireEvent.click(screen.getByRole("button",{name:"Create public link"}));
    await waitFor(() => expect(api.startSharing).toHaveBeenCalledOnce());
    expect(api.startSharing).toHaveBeenCalledWith(expect.objectContaining({filter,consent:true,fields:{descriptions:false,billable:false},ttlSeconds:3600}));
  });

  it("does not create a tunnel when preview fails", async () => {
    vi.mocked(api.previewSharing).mockRejectedValue(new Error("Report range is too large"));
    render(<TestApp />);
    fireEvent.click(screen.getByRole("button",{name:"Share"}));
    await screen.findByRole("alert");
    expect(screen.getByRole("button",{name:"Create public link"})).toBeDisabled();
    expect(api.startSharing).not.toHaveBeenCalled();
  });

  it("keeps stop sharing available across pages and replaces the current link", async () => {
    const active:SharingStatus = {...off,phase:"active",message:"Sharing is live",url:"https://demo.trycloudflare.com/s/current/",expiresAtUtc:Date.now()+60000,
      scope:{title:"Approved report",filter,fields:{descriptions:false,billable:false},ttlSeconds:60,initialView:"report",consent:true}};
    vi.mocked(api.getSharingStatus).mockResolvedValue(active);
    vi.mocked(api.rotateSharingLink).mockResolvedValue({...active,url:"https://demo.trycloudflare.com/s/replacement/"});
    render(<TestApp />);
    await screen.findByText("Live report sharing");
    fireEvent.click(screen.getByRole("button",{name:"Manage"}));
    fireEvent.click(screen.getByRole("button",{name:"Replace link"}));
    await waitFor(() => expect(screen.getByLabelText("Shareable link")).toHaveValue("https://demo.trycloudflare.com/s/replacement/"));
    fireEvent.click(screen.getByRole("button",{name:"Close"}));
    fireEvent.click(screen.getByRole("button",{name:"Stop sharing"}));
    await waitFor(() => expect(api.stopSharing).toHaveBeenCalledOnce());
    expect(api.startSharing).not.toHaveBeenCalled();
  });
});
