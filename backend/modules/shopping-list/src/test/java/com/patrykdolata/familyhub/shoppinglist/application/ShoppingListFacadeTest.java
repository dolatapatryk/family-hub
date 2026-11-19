package com.patrykdolata.familyhub.shoppinglist.application;

import com.patrykdolata.familyhub.common.CurrentMember;
import com.patrykdolata.familyhub.common.DirectTransactionRunner;
import com.patrykdolata.familyhub.common.FieldChange;
import com.patrykdolata.familyhub.common.FieldChange.SetValue;
import com.patrykdolata.familyhub.common.FieldChange.Unchanged;
import com.patrykdolata.familyhub.common.HouseholdId;
import com.patrykdolata.familyhub.common.UserId;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemNotFound;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListFilter;
import com.patrykdolata.familyhub.shoppinglist.infrastructure.InMemoryShoppingListRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;

import static com.patrykdolata.familyhub.common.HouseholdId.randomHouseholdId;
import static com.patrykdolata.familyhub.common.UserId.randomUserId;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem.shoppingItem;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId.randomShoppingItemId;
import static java.time.ZoneOffset.UTC;
import static java.util.Optional.empty;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ShoppingListFacadeTest {

    private static final Instant NOW = Instant.parse("2026-11-14T10:15:30Z");

    private final HouseholdId householdId = randomHouseholdId();
    private final HouseholdId anotherHouseholdId = randomHouseholdId();
    private final UserId userId = randomUserId();
    private final CurrentMember member = new CurrentMember(userId, householdId);
    private final Clock clock = Clock.fixed(NOW, UTC);

    private final InMemoryShoppingListRepository repository = new InMemoryShoppingListRepository();
    private final ShoppingListFacade facade = new ShoppingListFacade(repository, new DirectTransactionRunner(), clock);

    @Test
    void list_returns_items_for_household_and_completion_filter() {
        // given
        var pendingItem = item(householdId, "Milk", false);
        var completedItem = item(householdId, "Bread", true);
        var otherHouseholdItem = item(anotherHouseholdId, "Eggs", false);
        repository.save(pendingItem);
        repository.save(completedItem);
        repository.save(otherHouseholdItem);

        // then
        assertThat(facade.list(new ShoppingListFilter(householdId, false)))
            .containsExactly(pendingItem);
        assertThat(facade.list(new ShoppingListFilter(householdId, true)))
            .containsExactly(completedItem);
    }

    @Test
    void create_saves_item_for_member_with_current_time() {
        // given
        var command = new CreateShoppingItemCommand(
            "  Oat milk  ", Optional.of(" 2 cartons "), Optional.of("  Local shop  ")
        );

        // when
        var created = facade.create(member, command);

        // then
        assertThat(created).isEqualTo(
            shoppingItem()
                .id(created.id())
                .householdId(householdId)
                .name("Oat milk")
                .completed(false)
                .addedBy(userId)
                .createdAt(NOW)
                .quantity("2 cartons")
                .store("Local shop")
                .build()
        );
        assertThat(repository.find(created.id(), householdId)).contains(created);
    }

    @Test
    void update_applies_set_fields_and_preserves_unchanged_fields() {
        // given
        var original = item(householdId, "Oat milk", false);
        repository.save(original);
        var command = new UpdateShoppingItemCommand(
            new SetValue<>("  Almond milk  "),
            new Unchanged<>(),
            new SetValue<>(empty())
        );

        // when
        var updated = facade.update(member, original.id(), command);

        // then
        assertThat(updated).isEqualTo(original.update("Almond milk", original.quantity(), empty()));
    }

    @Test
    void update_does_not_save_when_item_is_unchanged() {
        // given
        var original = item(householdId, "Oat milk", false);
        repository.save(original);
        int savesBeforeUpdate = repository.saveCount();
        var command = new UpdateShoppingItemCommand(
            new Unchanged<>(),
            new Unchanged<>(),
            new Unchanged<>()
        );

        // when
        var updated = facade.update(member, original.id(), command);

        // then
        assertThat(updated).isEqualTo(original);
        assertThat(repository.saveCount()).isEqualTo(savesBeforeUpdate);
    }

    @Test
    void complete_marks_item_completed_and_saves_it() {
        // given
        var original = item(householdId, "Milk", false);
        repository.save(original);
        int savesBeforeComplete = repository.saveCount();

        // when
        var completed = facade.complete(member, original.id());

        // then
        assertThat(completed).isEqualTo(original.complete());
        assertThat(repository.find(original.id(), householdId)).contains(completed);
        assertThat(repository.saveCount()).isEqualTo(savesBeforeComplete + 1);
    }

    @Test
    void complete_does_not_save_when_item_is_already_completed() {
        // given
        var original = item(householdId, "Milk", true);
        repository.save(original);
        int savesBeforeComplete = repository.saveCount();

        // when
        var completed = facade.complete(member, original.id());

        // then
        assertThat(completed).isEqualTo(original);
        assertThat(repository.saveCount()).isEqualTo(savesBeforeComplete);
    }

    @Test
    void complete_cannot_access_item_from_another_household() {
        // given
        var otherHouseholdItem = item(anotherHouseholdId, "Milk", false);
        repository.save(otherHouseholdItem);
        int savesBeforeComplete = repository.saveCount();

        // then
        assertThatThrownBy(() -> facade.complete(member, otherHouseholdItem.id()))
            .isInstanceOf(ShoppingItemNotFound.class);
        assertThat(repository.saveCount()).isEqualTo(savesBeforeComplete);
    }

    @Test
    void reopen_marks_item_pending_and_saves_it() {
        // given
        var original = item(householdId, "Milk", true);
        repository.save(original);
        int savesBeforeReopen = repository.saveCount();

        // when
        var reopened = facade.reopen(member, original.id());

        // then
        assertThat(reopened).isEqualTo(original.reopen());
        assertThat(repository.find(original.id(), householdId)).contains(reopened);
        assertThat(repository.saveCount()).isEqualTo(savesBeforeReopen + 1);
    }

    @Test
    void reopen_does_not_save_when_item_is_already_pending() {
        // given
        var original = item(householdId, "Milk", false);
        repository.save(original);
        int savesBeforeReopen = repository.saveCount();

        // when
        var reopened = facade.reopen(member, original.id());

        // then
        assertThat(reopened).isEqualTo(original);
        assertThat(repository.saveCount()).isEqualTo(savesBeforeReopen);
    }

    @Test
    void reopen_cannot_access_item_from_another_household() {
        // given
        var otherHouseholdItem = item(anotherHouseholdId, "Milk", true);
        repository.save(otherHouseholdItem);
        int savesBeforeReopen = repository.saveCount();

        // then
        assertThatThrownBy(() -> facade.reopen(member, otherHouseholdItem.id()))
            .isInstanceOf(ShoppingItemNotFound.class);
        assertThat(repository.saveCount()).isEqualTo(savesBeforeReopen);
    }

    @Test
    void update_cannot_access_item_from_another_household() {
        // given
        var otherHouseholdItem = item(anotherHouseholdId, "Eggs", false);
        repository.save(otherHouseholdItem);
        var command = new UpdateShoppingItemCommand(
            new SetValue<>("Changed"),
            new Unchanged<>(),
            new Unchanged<>()
        );

        // then
        assertThatThrownBy(() -> facade.update(member, otherHouseholdItem.id(), command))
            .isInstanceOf(ShoppingItemNotFound.class);
    }

    @Test
    void delete_removes_item_for_member() {
        // given
        var item = item(householdId, "Coffee", false);
        repository.save(item);

        // when
        facade.delete(member, item.id());

        // then
        assertThat(repository.find(item.id(), householdId)).isEmpty();
    }

    @Test
    void clearCompleted_deletes_only_completed_items_from_members_household_and_returns_count() {
        // given
        var completedItem = item(householdId, "Tea", true);
        var anotherCompletedItem = item(householdId, "Coffee", true);
        var pendingItem = item(householdId, "Sugar", false);
        var otherHouseholdItem = item(anotherHouseholdId, "Rice", true);
        repository.save(completedItem);
        repository.save(anotherCompletedItem);
        repository.save(pendingItem);
        repository.save(otherHouseholdItem);

        // when
        int deletedCount = facade.clearCompleted(member);

        // then
        assertThat(deletedCount).isEqualTo(2);
        assertThat(repository.find(completedItem.id(), householdId)).isEmpty();
        assertThat(repository.find(anotherCompletedItem.id(), householdId)).isEmpty();
        assertThat(repository.find(pendingItem.id(), householdId)).contains(pendingItem);
        assertThat(repository.find(otherHouseholdItem.id(), anotherHouseholdId)).contains(otherHouseholdItem);
    }

    private ShoppingItem item(HouseholdId householdId, String name, boolean completed) {
        return shoppingItem()
            .id(randomShoppingItemId())
            .householdId(householdId)
            .name(name)
            .completed(completed)
            .addedBy(userId)
            .createdAt(NOW)
            .build();
    }
}
