export function createEmployeeHandlers({ employeeService }) {
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  return {
    async create(req, res) {
      const employee = await employeeService.createBde(req.user, req.body);
      res.status(201).set('Cache-Control', 'no-store').json({ employee });
    },
    async list(req, res) { noStore(res).json({ employees: await employeeService.list(req.user) }); },
    async setActive(req, res) { noStore(res).json({ employee: await employeeService.setActive(req.user, req.params.id, req.body && req.body.isActive) }); },
    async resetPassword(req, res) { noStore(res).json(await employeeService.resetPassword(req.user, req.params.id)); }
  };
}
