import { describe, expect, it } from "vitest";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import {
  BusinessCatalogService,
  BusinessDirectoryService,
  InMemoryBusinessRepository,
} from "../../src/modules/business/index.js";

const createCatalog = () => new BusinessCatalogService(new BusinessDirectoryService(
  new InMemoryBusinessRepository([DEVELOPMENT_BUSINESS]),
));

describe("BusinessCatalogService", () => {
  it("creates, updates and deletes an unassigned tenant service", async () => {
    const catalog = createCatalog();
    const created = await catalog.createService(DEVELOPMENT_BUSINESS.tenantId, {
      id: "whitening",
      name: "Blanqueamiento",
      description: "Tratamiento cosmético",
      durationMinutes: 60,
      bufferMinutes: 10,
      active: true,
    }, 1);
    expect(created).toMatchObject({ ok: true, value: { version: 2, service: { id: "whitening" } } });

    const updated = await catalog.updateService(DEVELOPMENT_BUSINESS.tenantId, "whitening", {
      name: "Blanqueamiento premium",
      description: "Tratamiento cosmético",
      durationMinutes: 75,
      bufferMinutes: 15,
      active: true,
    }, 2);
    expect(updated).toMatchObject({
      ok: true,
      value: { version: 3, service: { name: "Blanqueamiento premium", durationMinutes: 75 } },
    });

    await expect(catalog.deleteService(DEVELOPMENT_BUSINESS.tenantId, "whitening", 3))
      .resolves.toEqual({ ok: true, value: { version: 4, deletedServiceId: "whitening" } });
    await expect(catalog.listServices(DEVELOPMENT_BUSINESS.tenantId)).resolves.toMatchObject({
      ok: true,
      value: { version: 4, services: expect.not.arrayContaining([expect.objectContaining({ id: "whitening" })]) },
    });
  });

  it("protects assigned services from deactivation and deletion", async () => {
    const catalog = createCatalog();
    const consultation = DEVELOPMENT_BUSINESS.services.find(({ id }) => id === "consultation")!;
    await expect(catalog.updateService(DEVELOPMENT_BUSINESS.tenantId, consultation.id, {
      name: consultation.name,
      description: consultation.description,
      durationMinutes: consultation.durationMinutes,
      bufferMinutes: consultation.bufferMinutes,
      active: false,
    }, 1)).resolves.toEqual({ ok: false, error: { code: "SERVICE_IN_USE" } });
    await expect(catalog.deleteService(DEVELOPMENT_BUSINESS.tenantId, consultation.id, 1))
      .resolves.toEqual({ ok: false, error: { code: "SERVICE_IN_USE" } });
  });

  it("manages professionals and their location assignments as separate steps", async () => {
    const catalog = createCatalog();
    const created = await catalog.createProfessional(DEVELOPMENT_BUSINESS.tenantId, {
      id: "employee-3", displayName: "Dra. Elena", active: true,
    }, 1);
    expect(created).toMatchObject({ ok: true, value: { version: 2 } });

    const assigned = await catalog.setProfessionalAssignment(
      DEVELOPMENT_BUSINESS.tenantId,
      "default",
      "employee-3",
      { active: true, serviceIds: ["consultation"], openingHours: [] },
      2,
    );
    expect(assigned).toMatchObject({
      ok: true,
      value: { version: 3, assignment: { professionalId: "employee-3", serviceIds: ["consultation"] } },
    });
    await expect(catalog.deleteProfessional(DEVELOPMENT_BUSINESS.tenantId, "employee-3", 3))
      .resolves.toEqual({ ok: false, error: { code: "PROFESSIONAL_IN_USE" } });

    await expect(catalog.deleteProfessionalAssignment(
      DEVELOPMENT_BUSINESS.tenantId, "default", "employee-3", 3,
    )).resolves.toEqual({
      ok: true,
      value: { version: 4, locationId: "default", deletedProfessionalId: "employee-3" },
    });
    await expect(catalog.deleteProfessional(DEVELOPMENT_BUSINESS.tenantId, "employee-3", 4))
      .resolves.toEqual({ ok: true, value: { version: 5, deletedProfessionalId: "employee-3" } });
  });

  it("does not remove a professional referenced by an appointment", async () => {
    const businesses = new BusinessDirectoryService(new InMemoryBusinessRepository([DEVELOPMENT_BUSINESS]));
    const catalog = new BusinessCatalogService(businesses, {
      hasProfessionalReferences: async () => true,
    });
    const current = await businesses.getBusinessConfiguration(DEVELOPMENT_BUSINESS.tenantId);
    if (!current.ok) throw new Error("Expected configuration");
    const withoutAssignment = {
      ...current.value.configuration,
      locations: current.value.configuration.locations.map((location) => ({
        ...location,
        professionals: location.professionals.filter(({ professionalId }) => professionalId !== "employee-2"),
      })),
    };
    await businesses.updateBusinessConfiguration(DEVELOPMENT_BUSINESS.tenantId, withoutAssignment, 1);

    await expect(catalog.deleteProfessional(DEVELOPMENT_BUSINESS.tenantId, "employee-2", 2))
      .resolves.toEqual({ ok: false, error: { code: "PROFESSIONAL_IN_USE" } });
  });
});
