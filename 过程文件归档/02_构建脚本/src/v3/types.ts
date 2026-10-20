export const DORM_MARKS = ["未核实", "在寝", "请假", "外宿", "未归"] as const;
export type DormMark = (typeof DORM_MARKS)[number];

export const ENROLL_STATUSES = [
  "在籍",
  "休学",
  "退学",
  "留级",
  "毕业",
  "结业",
  "保留",
  "待核实",
] as const;
export type EnrollStatus = (typeof ENROLL_STATUSES)[number];

export const ROSTER_FILTERS = [
  "全部",
  "在籍",
  "异动",
  "骨干",
  "特情",
  "本学年受助",
  "受助",
] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export const VIEWS = [
  ["deck", "工作总览"],
  ["digest", "数据统计"],
  ["roster", "学生名册"],
  ["sweep", "宿舍查寝"],
  ["talks", "谈心谈话"],
  ["ledger", "数据台账"],
  ["tools", "可选工具"],
  ["support", "联系与说明"],
] as const;

export type ViewId = (typeof VIEWS)[number][0];

export type AidYear = {
  label: string;
  hardship: string;
  grant: string;
};

export type Student = {
  id: string;
  name: string;
  gender: "男" | "女" | "未填写";
  ethnicity: string;
  photo?: string;
  college: string;
  major: string;
  className: string;
  enrollYear: number;
  status: EnrollStatus;
  statusChange: string;
  phone1: string;
  phone2: string;
  familyPhone: string;
  emergencyRelation: string;
  emergencyName: string;
  emergencyPhone: string;
  counselor: string;
  building: string;
  room: string;
  bed: string;
  roles: string[];
  birthday: string;
  politics: string;
  idNumber: string;
  psych: string;
  aid: AidYear[];
  loan: string;
  address: string;
  bank: string;
  bankCard: string;
  ledgerFields?: Record<string, string>;
  recognition?: { hometown: string; needyLabel: string; psychLabel: string; sourceStamp: string; assessmentAddress?:string; other?:string; definition?:string; identityStamp?:string; source?:string };
};

export type PhotoRecord = {
  key: string;
  path: string;
  tokens: string[];
  fields: Record<string, string>;
  importedAt: string;
  studentId: string | null;
  manualStudentId?: string;
  photo?: string;
  issues: string[];
};

export type Talk = {
  id: string;
  studentId: string;
  at: string;
  note: string;
};

export const AID_LABELS = ["第一学年", "第二学年", "第三学年", "第四学年"] as const;

export const BENCH = {
  name: "辅导员工作台",
  counselor: "",
  college: "",
} as const;
