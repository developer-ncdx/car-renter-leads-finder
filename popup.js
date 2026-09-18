(() => {
  "use strict";

  const {
    GROUP_TYPES,
    parseGroupId,
    canonicalGroupUrl,
    loadGroups,
    saveGroups
  } = globalThis.FbGroupConfig;

  const form = document.querySelector("#group-form");
  const input = document.querySelector("#group-url");
  const addButton = document.querySelector("#add-group");
  const status = document.querySelector("#status");
  const list = document.querySelector("#group-list");
  const groupsHeading = document.querySelector("#groups-heading");
  const count = document.querySelector("#group-count");
  const emptyState = document.querySelector("#empty-state");
  const itemTemplate = document.querySelector("#group-item-template");
  const typeInputs = [...form.querySelectorAll('input[name="groupType"]')];

  let groups = [];

  function setStatus(message = "", type = "") {
    status.textContent = message;
    status.className = `status${type ? ` ${type}` : ""}`;
  }

  function setFormBusy(isBusy) {
    input.disabled = isBusy;
    addButton.disabled = isBusy;
    typeInputs.forEach((typeInput) => {
      typeInput.disabled = isBusy;
    });
  }

  async function removeGroup(groupId, button) {
    button.disabled = true;

    try {
      groups = await saveGroups(
        groups.filter((group) => group.id !== groupId)
      );
      renderGroups();
      setStatus(`Group ${groupId} removed.`, "success");
    } catch (error) {
      button.disabled = false;
      setStatus(`Could not remove group: ${error.message}`, "error");
    }
  }

  function renderGroups() {
    list.replaceChildren();
    const selectedType =
      typeInputs.find((typeInput) => typeInput.checked)?.value ??
      GROUP_TYPES.RENTAL;
    const visibleGroups = groups.filter(
      (group) => group.type === selectedType
    );
    const isJob = selectedType === GROUP_TYPES.JOB;

    for (const group of visibleGroups) {
      const item = itemTemplate.content.firstElementChild.cloneNode(true);
      const link = item.querySelector(".group-link");
      const label = item.querySelector(".group-label");
      const typeBadge = item.querySelector(".group-type");
      const urlLabel = item.querySelector(".group-url");
      const removeButton = item.querySelector(".remove-group");
      const groupUrl = canonicalGroupUrl(group.id);
      const typeLabel = group.type === GROUP_TYPES.JOB
        ? "Job posts"
        : "Car rental";

      link.href = groupUrl;
      link.title = `Open Facebook group ${group.id}`;
      label.textContent = `Group ${group.id}`;
      typeBadge.textContent = typeLabel;
      typeBadge.className = `group-type ${group.type}`;
      urlLabel.textContent = groupUrl.replace("https://www.", "");
      removeButton.setAttribute(
        "aria-label",
        `Remove Facebook group ${group.id}`
      );
      removeButton.addEventListener("click", () => {
        removeGroup(group.id, removeButton);
      });

      list.append(item);
    }

    groupsHeading.textContent = isJob
      ? "Job-posting groups"
      : "Car-rental groups";
    count.textContent = String(visibleGroups.length);
    count.setAttribute(
      "aria-label",
      `${visibleGroups.length} monitored ${
        visibleGroups.length === 1 ? "group" : "groups"
      }`
    );
    emptyState.textContent = isJob
      ? "No job-posting groups added yet."
      : "No car-rental groups added yet.";
    emptyState.hidden = visibleGroups.length !== 0;
  }

  typeInputs.forEach((typeInput) => {
    typeInput.addEventListener("change", () => {
      setStatus();
      renderGroups();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus();

    const groupId = parseGroupId(input.value);
    const selectedType = new FormData(form).get("groupType");

    if (!groupId) {
      setStatus(
        "Enter a Facebook group URL with a numeric ID or custom group name.",
        "error"
      );
      input.focus();
      return;
    }

    const existingGroup = groups.find((group) => group.id === groupId);

    if (existingGroup?.type === selectedType) {
      setStatus(
        `Group ${groupId} is already monitored for this type.`,
        "error"
      );
      input.select();
      return;
    }

    setFormBusy(true);

    try {
      const nextGroups = existingGroup
        ? groups.map((group) =>
          group.id === groupId
            ? { ...group, type: selectedType }
            : group
        )
        : [...groups, { id: groupId, type: selectedType }];

      groups = await saveGroups(nextGroups);
      renderGroups();
      input.value = "";
      setStatus(
        existingGroup
          ? `Group ${groupId} changed to ${
            selectedType === GROUP_TYPES.JOB ? "Job posts" : "Car rental"
          }.`
          : `Group ${groupId} added.`,
        "success"
      );
    } catch (error) {
      setStatus(`Could not add group: ${error.message}`, "error");
    } finally {
      setFormBusy(false);
      input.focus();
    }
  });

  async function initialize() {
    try {
      groups = await loadGroups();
      renderGroups();
    } catch (error) {
      setStatus(`Could not load groups: ${error.message}`, "error");
    }
  }

  initialize();
})();
