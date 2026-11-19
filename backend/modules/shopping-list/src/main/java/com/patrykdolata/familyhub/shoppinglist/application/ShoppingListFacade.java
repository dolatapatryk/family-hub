package com.patrykdolata.familyhub.shoppinglist.application;

import com.patrykdolata.familyhub.common.CurrentMember;
import com.patrykdolata.familyhub.common.TransactionRunner;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListFilter;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListRepository;

import java.time.Clock;
import java.util.List;

import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem.shoppingItem;
import static java.util.Objects.requireNonNull;

public final class ShoppingListFacade {

    private final ShoppingListRepository repository;
    private final TransactionRunner transactions;
    private final Clock clock;

    public ShoppingListFacade(ShoppingListRepository repository, TransactionRunner transactions, Clock clock) {
        this.repository = requireNonNull(repository, "repository");
        this.transactions = requireNonNull(transactions, "transactions");
        this.clock = requireNonNull(clock, "clock");
    }

    public List<ShoppingItem> list(ShoppingListFilter filter) {
        return repository.list(filter);
    }

    public ShoppingItem create(CurrentMember member, CreateShoppingItemCommand command) {
        var item = shoppingItem()
            .householdId(member.householdId())
            .name(command.name())
            .quantity(command.quantity())
            .store(command.store())
            .addedBy(member.userId())
            .createdAt(clock.instant())
            .build();
        return repository.save(item);
    }

    public ShoppingItem update(CurrentMember member, ShoppingItemId id, UpdateShoppingItemCommand command) {
        return transactions.execute(() -> {
            var current = repository.get(id, member.householdId());
            var updated = current.update(
                command.name().applyTo(current.name()),
                command.quantity().applyTo(current.quantity()),
                command.store().applyTo(current.store())
            );
            return saveIfChanged(current, updated);
        });
    }

    public ShoppingItem complete(CurrentMember member, ShoppingItemId id) {
        return transactions.execute(() -> {
            var item = repository.get(id, member.householdId());
            return saveIfChanged(item, item.complete());
        });
    }

    public ShoppingItem reopen(CurrentMember member, ShoppingItemId id) {
        return transactions.execute(() -> {
            var item = repository.get(id, member.householdId());
            return saveIfChanged(item, item.reopen());
        });
    }

    private ShoppingItem saveIfChanged(ShoppingItem current, ShoppingItem updated) {
        return current.equals(updated) ? current : repository.save(updated);
    }

    public void delete(CurrentMember member, ShoppingItemId id) {
        transactions.execute(() -> {
            ShoppingItem current = repository.get(id, member.householdId());
            repository.delete(id, member.householdId());
            return current;
        });
    }

    public int clearCompleted(CurrentMember member) {
        return repository.deleteCompleted(member.householdId());
    }
}
