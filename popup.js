(() => {
  "use strict";

  const {
    parseGroupId,
    canonicalGroupUrl,
    loadGroupIds,
    saveGroupIds
  } = globalThis.FbGroupConfig;

  const form = document.querySelector("#group-form");
  const input = document.querySelector("#group-url");
  const addButton = document.querySelector("#add-group");
  const status = document.querySelector("#status");
  const list = document.querySelector("#group-list");
  const count = document.querySelector("#group-count");
  const emptyState = document.querySelector("#empty-state");
  const itemTemplate = document.querySelector("#group-item-template");

  let groupIds = [];

  function setStatus(message = "", type = "") {
    status.textContent = message;
    status.className = `status${type ? ` ${type}` : ""}`;
  }

  function setFormBusy(isBusy) {
    input.disabled = isBusy;
    addButton.disabled = isBusy;
  }

  async function removeGroup(groupId, button) {
    button.disabled = true;

    try {
      groupIds = await saveGroupIds(
        groupIds.filter((currentId) => currentId !== groupId)
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

    for (const groupId of groupIds) {
      const item = itemTemplate.content.firstElementChild.cloneNode(true);
      const link = item.querySelector(".group-link");
      const label = item.querySelector(".group-label");
      const urlLabel = item.querySelector(".group-url");
      const removeButton = item.querySelector(".remove-group");
      const groupUrl = canonicalGroupUrl(groupId);

      link.href = groupUrl;
      link.title = `Open Facebook group ${groupId}`;
      label.textContent = `Group ${groupId}`;
      urlLabel.textContent = groupUrl.replace("https://www.", "");
      removeButton.setAttribute(
        "aria-label",
        `Remove Facebook group ${groupId}`
      );
      removeButton.addEventListener("click", () => {
        removeGroup(groupId, removeButton);
      });

      list.append(item);
    }

    count.textContent = String(groupIds.length);
    count.setAttribute(
      "aria-label",
      `${groupIds.length} monitored ${groupIds.length === 1 ? "group" : "groups"}`
    );
    emptyState.hidden = groupIds.length !== 0;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus();

    const groupId = parseGroupId(input.value);

    if (!groupId) {
      setStatus(
        "Enter a Facebook group URL containing a numeric group ID.",
        "error"
      );
      input.focus();
      return;
    }

    if (groupIds.includes(groupId)) {
      setStatus(`Group ${groupId} is already monitored.`, "error");
      input.select();
      return;
    }

    setFormBusy(true);

    try {
      groupIds = await saveGroupIds([...groupIds, groupId]);
      renderGroups();
      input.value = "";
      setStatus(`Group ${groupId} added.`, "success");
    } catch (error) {
      setStatus(`Could not add group: ${error.message}`, "error");
    } finally {
      setFormBusy(false);
      input.focus();
    }
  });

  async function initialize() {
    try {
      groupIds = await loadGroupIds();
      renderGroups();
    } catch (error) {
      setStatus(`Could not load groups: ${error.message}`, "error");
    }
  }

  initialize();
})();
