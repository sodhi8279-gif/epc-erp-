// Sets the icon and version details on the Windows .exe without Wine (pure JS, via resedit).
const fs = require('node:fs');
const ResEdit = require('resedit');
const [exePath, icoPath, version] = process.argv.slice(2);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
for (const g of ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map((i) => i.data));
}
const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const v = version.split('.').map(Number);
vi.setFileVersion(v[0], v[1], v[2], 0, 1033); vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: 'EPC Contracts & Billing', ProductName: 'EPC Contracts & Billing', CompanyName: 'EPC Contracts & Billing',
  InternalName: 'EPC Contracts', OriginalFilename: 'EPC Contracts.exe', LegalCopyright: '', FileVersion: version, ProductVersion: version,
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('Resources set on', exePath);
