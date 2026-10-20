import type { PhotoRecord, Student } from "../types.ts";

// Preserve empty positions and unrecognised fields: source text is never discarded.
export function parsePhotoName(path: string) {
  const base = path.split(/[/\\]/).pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, "");
  const tokens = stem.split("_");
  const fields: Record<string, string> = {};
  const issues: string[] = [];
  if (tokens.length >= 6) {
    ["班级", "姓名", "学号", "贫困", "心理", "籍贯"].forEach((key, index) => {
      fields[key] = tokens[index].trim();
    });
    fields["贫困含义"] = fields["贫困"] || "无";
    fields["心理含义"] = fields["心理"] || "无";
    tokens.slice(6).forEach((value, index) => {
      if (value || index < tokens.length - 7) fields[`附加字段${index + 1}`] = value;
    });
    if (!/^[0-9]{8,12}$/.test(fields["学号"])) issues.push("学号格式需核对");
    if (!fields["班级"] || !fields["姓名"]) issues.push("班级或姓名为空");
    if (!fields["籍贯"]) issues.push("籍贯为空");
  } else {
    fields["文件名原文"] = stem;
  }
  return { tokens, fields, issues };
}

export function reconcilePhotoRecords(records: PhotoRecord[], students: Student[]) {
  const next = records.map((r) => {
    if (r.manualStudentId === "")
      return { ...r, studentId: null, issues: ["已选用另一张照片，原来源保留"] };
    if (r.manualStudentId && students.some((s) => s.id === r.manualStudentId)) {
      return { ...r, studentId: r.manualStudentId, issues: ["已人工核对关联，保留文件名原文"] };
    }
    const issues = parsePhotoName(r.path).issues;
    const blockers: string[] = [];
    const id = r.fields["学号"];
    const name = r.fields["姓名"];
    let matches: Student[] = [];
    if (id) matches = students.filter((s) => s.id === id);
    else if (r.studentId) matches = students.filter((s) => s.id === r.studentId);
    else {
      const stem = r.fields["文件名原文"]?.trim() ?? "";
      matches = students.filter((s) => s.id === stem || s.name === stem);
    }
    if (matches.length !== 1)
      blockers.push(matches.length > 1 ? "重名，需手动关联" : "未找到台账学生");
    const hit = matches.length === 1 ? matches[0] : null;
    if (hit && name && name !== hit.name) blockers.push("学号相同，姓名与台账冲突");
    if (id && Object.hasOwn(r.fields, "姓名") && !name) blockers.push("姓名为空，需核对");
    return {
      ...r,
      studentId: hit && !blockers.length ? hit.id : null,
      issues: [...new Set([...issues, ...blockers])],
    };
  });
  // Two source photos claiming one person require review instead of last-write-wins.
  const counts = new Map<string, number>();
  for (const r of next)
    if (r.studentId) counts.set(r.studentId, (counts.get(r.studentId) ?? 0) + 1);
  return next.map((r) =>
    r.studentId && (counts.get(r.studentId) ?? 0) > 1
      ? { ...r, studentId: null, issues: [...r.issues, "同一学生有多张照片，需核对"] }
      : r,
  );
}

export function applyPhotoRecords(students: Student[], records: PhotoRecord[]) {
  const byId = new Map(
    records.filter((r) => r.studentId && r.photo).map((r) => [r.studentId, r.photo]),
  );
  return students.map((s) => (byId.has(s.id) ? { ...s, photo: byId.get(s.id) } : s));
}

export function mergeRoster(old: Student[], incoming: Student[]) {
  const result = new Map(old.map((s) => [s.id, s]));
  for (const student of incoming) {
    const current = result.get(student.id);
    if (!current) {
      result.set(student.id, student);
      continue;
    }
    const next = { ...current, ledgerFields: { ...current.ledgerFields, ...student.ledgerFields } };
    // Only populated source columns update facts; absent/empty columns do not erase local data.
    for (const [key, value] of Object.entries(student)) {
      if (key === "ledgerFields" || key === "photo" || key === "aid") continue;
      if (
        value !== "" &&
        value !== 0 &&
        value !== "未填写" &&
        value !== "待核实" &&
        value !== "未分班" &&
        value !== "未分配" &&
        value !== "—" &&
        (!Array.isArray(value) || value.length)
      )
        Object.assign(next, { [key]: value });
    }
    next.aid = current.aid.map((year) => {
      const updated = student.aid.find((y) => y.label === year.label);
      return {
        ...year,
        hardship: updated?.hardship || year.hardship,
        grant: updated?.grant || year.grant,
      };
    });
    result.set(student.id, next);
  }
  return [...result.values()];
}
