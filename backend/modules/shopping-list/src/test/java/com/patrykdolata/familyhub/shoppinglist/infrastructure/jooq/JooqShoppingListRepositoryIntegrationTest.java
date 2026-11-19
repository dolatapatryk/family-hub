package com.patrykdolata.familyhub.shoppinglist.infrastructure.jooq;

import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItem;
import com.patrykdolata.familyhub.shoppinglist.domain.ShoppingListFilter;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Instant;

import static com.patrykdolata.familyhub.common.HouseholdId.randomHouseholdId;
import static com.patrykdolata.familyhub.common.UserId.randomUserId;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemTestData.aShoppingItem;
import static com.patrykdolata.familyhub.shoppinglist.domain.ShoppingItemId.shoppingItemId;
import static java.util.Optional.empty;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.jooq.SQLDialect.POSTGRES;
import static org.jooq.impl.DSL.using;

@Testcontainers(disabledWithoutDocker = true)
class JooqShoppingListRepositoryIntegrationTest {

    @Container
    private static final PostgreSQLContainer POSTGRES_CONTAINER = new PostgreSQLContainer("postgres:16-alpine");

    private static Connection connection;
    private static DSLContext dsl;
    private static JooqShoppingListRepository repository;

    @BeforeAll
    static void createSchema() throws SQLException {
        connection = DriverManager.getConnection(
            POSTGRES_CONTAINER.getJdbcUrl(),
            POSTGRES_CONTAINER.getUsername(),
            POSTGRES_CONTAINER.getPassword()
        );
        dsl = using(connection, POSTGRES);
        dsl.execute("""
            CREATE TABLE public.shopping_items (
                id uuid PRIMARY KEY,
                household_id uuid NOT NULL,
                name text NOT NULL,
                quantity text,
                store text,
                completed boolean NOT NULL DEFAULT false,
                added_by uuid NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )
            """);
        repository = new JooqShoppingListRepository(dsl);
    }

    @AfterAll
    static void closeConnection() throws SQLException {
        if (connection != null) {
            connection.close();
        }
    }

    @BeforeEach
    void clearTables() {
        dsl.execute("TRUNCATE TABLE public.shopping_items");
    }

    @Test
    void saves_and_updates_items() {
        // given
        var original = aShoppingItem()
            .createdAt(Instant.parse("2026-11-14T10:15:30Z"))
            .quantity(empty())
            .store(empty())
            .build();
        save(original);

        var updated = original.copy()
            .name("  Bread  ")
            .quantity("2 loaves")
            .completed(true)
            .build();

        // when
        repository.save(updated);

        // then
        assertThat(repository.find(original.id(), original.householdId())).contains(updated);
    }

    @Test
    void find_and_list_are_scoped_and_list_is_ordered() {
        // given
        var householdId = randomHouseholdId();
        var userId = randomUserId();
        var otherHouseholdItem = aShoppingItem()
            .createdAt(Instant.parse("2026-11-13T10:00:00Z"))
            .build();
        var later = aShoppingItem()
            .householdId(householdId)
            .addedBy(userId)
            .createdAt(Instant.parse("2026-11-15T10:00:00Z"))
            .build();
        var tiedByIdFirst = aShoppingItem()
            .householdId(householdId)
            .addedBy(userId)
            .createdAt(Instant.parse("2026-11-14T10:00:00Z"))
            .id(shoppingItemId("00000000-0000-0000-0000-000000000001"))
            .build();
        var tiedByIdSecond = aShoppingItem()
            .householdId(householdId)
            .addedBy(userId)
            .createdAt(Instant.parse("2026-11-14T10:00:00Z"))
            .id(shoppingItemId("00000000-0000-0000-0000-000000000002"))
            .build();
        var completed = aShoppingItem()
            .householdId(householdId)
            .addedBy(userId)
            .createdAt(Instant.parse("2026-11-12T10:00:00Z"))
            .completed(true)
            .build();
        save(otherHouseholdItem, later, tiedByIdSecond, tiedByIdFirst, completed);

        // when
        var activeItems = repository.list(new ShoppingListFilter(householdId, false));
        var completedItems = repository.list(new ShoppingListFilter(householdId, true));

        // then
        assertThat(repository.find(later.id(), otherHouseholdItem.householdId())).isEmpty();
        assertThat(repository.find(later.id(), householdId)).contains(later);
        assertThat(activeItems).containsExactly(tiedByIdFirst, tiedByIdSecond, later);
        assertThat(completedItems).containsExactly(completed);
    }

    @Test
    void delete_only_removes_item_from_the_requested_household() {
        // given
        var item = aShoppingItem()
            .createdAt(Instant.parse("2026-11-14T10:15:30Z"))
            .build();
        save(item);
        var otherHouseholdId = randomHouseholdId();

        // when
        repository.delete(item.id(), otherHouseholdId);

        // then
        assertThat(repository.find(item.id(), item.householdId())).contains(item);

        // when
        repository.delete(item.id(), item.householdId());

        // then
        assertThat(repository.find(item.id(), item.householdId())).isEmpty();
    }

    @Test
    void delete_completed_removes_only_completed_items_from_the_requested_household() {
        // given
        var householdId = randomHouseholdId();
        var userId = randomUserId();
        var active = aShoppingItem()
            .householdId(householdId)
            .addedBy(userId)
            .createdAt(Instant.parse("2026-11-14T10:00:00Z"))
            .build();
        var completedOne = aShoppingItem()
            .householdId(householdId)
            .addedBy(userId)
            .createdAt(Instant.parse("2026-11-14T10:01:00Z"))
            .completed(true)
            .build();
        var completedTwo = aShoppingItem()
            .householdId(householdId)
            .addedBy(userId)
            .createdAt(Instant.parse("2026-11-14T10:02:00Z"))
            .completed(true)
            .build();
        var otherHouseholdCompleted = aShoppingItem()
            .createdAt(Instant.parse("2026-11-14T10:03:00Z"))
            .completed(true)
            .build();
        save(active, completedOne, completedTwo, otherHouseholdCompleted);

        // when
        var deletedCount = repository.deleteCompleted(householdId);

        // then
        assertThat(deletedCount).isEqualTo(2);
        assertThat(repository.list(new ShoppingListFilter(householdId, false))).containsExactly(active);
        assertThat(repository.find(otherHouseholdCompleted.id(), otherHouseholdCompleted.householdId()))
            .contains(otherHouseholdCompleted);
    }

    @Test
    void save_rejects_an_item_id_already_owned_by_another_household() {
        // given
        var original = aShoppingItem()
            .createdAt(Instant.parse("2026-11-14T10:15:30Z"))
            .build();
        save(original);
        var collision = original.copy()
            .householdId(randomHouseholdId())
            .addedBy(randomUserId())
            .name("Changed")
            .build();

        // then
        assertThatThrownBy(() -> save(collision))
            .isInstanceOf(IllegalStateException.class);
        assertThat(repository.find(original.id(), original.householdId())).contains(original);
    }

    private void save(ShoppingItem... items) {
        for (var item : items) {
            repository.save(item);
        }
    }
}
